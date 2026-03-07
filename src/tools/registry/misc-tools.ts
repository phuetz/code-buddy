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
import { SkillDiscoveryTool } from '../skill-discovery-tool.js';
import { DeviceTool } from '../device-tool.js';
import type { DeployTool } from '../deploy-tool.js';

// Lazy-loaded browser-automation module (accessibility + refs)
import type { BrowserTool as BrowserAutomationTool, BrowserToolInput } from '../../browser-automation/index.js';

// ============================================================================
// Shared Tool Instances (lazy loaded)
// ============================================================================

let browserInstance: BrowserAutomationTool | null = null;
let reasoningInstance: ReasoningTool | null = null;
let deployInstance: DeployTool | null = null;
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

async function getDeployInstance(): Promise<DeployTool> {
  if (!deployInstance) {
    const { getDeployTool } = await import('../deploy-tool.js');
    deployInstance = getDeployTool();
  }
  return deployInstance;
}

/**
 * Reset the shared instances (for testing)
 */
export function resetMiscInstances(): void {
  browserInstance = null;
  reasoningInstance = null;
  computerControlInstance = null;
  screenshotInstance = null;
  deployInstance = null;
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
  'click', 'left_click', 'middle_click', 'double_click', 'right_click', 'move_mouse', 'drag', 'scroll',
  'cursor_position', 'wait',
  'type', 'key', 'key_down', 'key_up', 'hotkey',
  'get_windows', 'get_window', 'list_window_matches', 'wait_for_window', 'focus_window', 'close_window',
  'get_active_window', 'minimize_window', 'maximize_window', 'restore_window', 'move_window', 'resize_window',
  'set_window', 'act_on_best_window', 'get_audit_log', 'clear_audit_log', 'export_audit_log',
  'set_pilot_mode', 'get_pilot_mode',
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
          pilotMode: {
            type: 'string',
            enum: ['cautious', 'normal', 'fast'],
            description: 'High-level piloting preset for default safety + matching behavior',
          },
          safetyProfile: {
            type: 'string',
            enum: ['balanced', 'strict'],
            description: 'Safety profile for action gating (strict blocks dangerous actions unless confirmed)',
          },
          confirmDangerous: {
            type: 'boolean',
            description: 'Required in strict profile for dangerous actions',
          },
          simulateOnly: {
            type: 'boolean',
            description: 'If true, do a dry-run for mutating actions without applying changes',
          },
          auditLimit: {
            type: 'number',
            description: 'Number of audit entries to return for get_audit_log (1-500)',
          },
          exportAuditPath: {
            type: 'string',
            description: 'Optional output path for export_audit_log JSON file',
          },
          policyOverrides: {
            type: 'object',
            description: 'Per-action safety overrides: { "close_window": "confirm|allow|block", ... }',
          },
          ref: { type: 'number', description: 'Element reference number from snapshot' },
          x: { type: 'number', description: 'X coordinate for mouse actions' },
          y: { type: 'number', description: 'Y coordinate for mouse actions' },
          width: { type: 'number', description: 'Window width (for resize_window)' },
          height: { type: 'number', description: 'Window height (for resize_window)' },
          text: { type: 'string', description: 'Text to type' },
          key: { type: 'string', description: 'Key to press' },
          seconds: { type: 'number', description: 'Wait duration in seconds (for wait action)' },
          modifiers: { type: 'array', items: { type: 'string' }, description: 'Modifier keys (ctrl, alt, shift, meta)' },
          button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button' },
          deltaX: { type: 'number', description: 'Horizontal scroll amount' },
          deltaY: { type: 'number', description: 'Vertical scroll amount' },
          windowTitle: { type: 'string', description: 'Window title to find/focus' },
          windowTitleRegex: { type: 'string', description: 'Case-insensitive regex pattern for window title matching' },
          windowTitleMatch: { type: 'string', enum: ['contains', 'equals'], description: 'Window title matching mode' },
          processName: { type: 'string', description: 'Process name to find/focus (e.g. Discord, chrome, msedge)' },
          processNameMatch: { type: 'string', enum: ['equals', 'contains'], description: 'Process name matching mode' },
          windowHandle: { type: 'string', description: 'Window handle to focus/close directly' },
          windowMatchStrategy: {
            type: 'string',
            enum: ['first', 'focused', 'largest', 'newest'],
            description: 'When multiple windows match, choose first, focused, largest, or newest',
          },
          requireUniqueWindowMatch: {
            type: 'boolean',
            description: 'If true, fail when multiple windows match instead of auto-selecting one',
          },
          focus: { type: 'boolean', description: 'Whether to focus window (for set_window)' },
          windowState: {
            type: 'string',
            enum: ['normal', 'minimized', 'maximized'],
            description: 'Target state for set_window',
          },
          bestWindowAction: {
            type: 'string',
            enum: ['focus', 'close', 'minimize', 'maximize', 'restore', 'move', 'resize', 'set'],
            description: 'Action used by act_on_best_window',
          },
          timeoutMs: { type: 'number', description: 'Timeout in milliseconds for wait_for_window' },
          pollIntervalMs: { type: 'number', description: 'Polling interval in milliseconds for wait_for_window' },
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
// SkillDiscoveryExecuteTool
// ============================================================================

let skillDiscoveryInstance: SkillDiscoveryTool | null = null;

function getSkillDiscovery(): SkillDiscoveryTool {
  if (!skillDiscoveryInstance) {
    skillDiscoveryInstance = new SkillDiscoveryTool();
  }
  return skillDiscoveryInstance;
}

/**
 * SkillDiscoveryExecuteTool - ITool adapter for skill auto-discovery
 */
export class SkillDiscoveryExecuteTool implements ITool {
  readonly name = 'skill_discover';
  readonly description = 'Search the Skills Hub for capabilities matching a query. Optionally auto-install the top result to expand the agent toolset at runtime.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await getSkillDiscovery().execute({
      query: input.query as string,
      tags: input.tags as string[] | undefined,
      auto_install: input.auto_install as boolean | undefined,
      limit: input.limit as number | undefined,
    });
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query to find relevant skills',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tags to filter by',
          },
          auto_install: {
            type: 'boolean',
            description: 'Automatically install the top matching skill (default: false)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default: 5)',
          },
        },
        required: ['query'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;
    if (typeof data.query !== 'string' || data.query.trim() === '') {
      return { valid: false, errors: ['query must be a non-empty string'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['skill', 'discover', 'install', 'capability', 'hub', 'search', 'plugin'],
      priority: 3,
      requiresConfirmation: false,
      modifiesFiles: false,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// DeviceExecuteTool
// ============================================================================

let deviceToolInstance: DeviceTool | null = null;

function getDeviceTool(): DeviceTool {
  if (!deviceToolInstance) {
    deviceToolInstance = new DeviceTool();
  }
  return deviceToolInstance;
}

/**
 * DeviceExecuteTool - ITool adapter for device management
 */
export class DeviceExecuteTool implements ITool {
  readonly name = 'device_manage';
  readonly description = 'Manage paired devices (SSH/ADB/local). List, pair, remove, screenshot, camera snap, screen record, get location, run commands.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    return await getDeviceTool().execute({
      action: input.action as 'list' | 'pair' | 'remove' | 'snap' | 'screenshot' | 'record' | 'location' | 'run',
      deviceId: input.deviceId as string | undefined,
      name: input.name as string | undefined,
      transport: input.transport as 'ssh' | 'adb' | 'local' | undefined,
      address: input.address as string | undefined,
      port: input.port as number | undefined,
      username: input.username as string | undefined,
      keyPath: input.keyPath as string | undefined,
      command: input.command as string | undefined,
      duration: input.duration as number | undefined,
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
            enum: ['list', 'pair', 'remove', 'snap', 'screenshot', 'record', 'location', 'run'],
            description: 'Device action to perform',
          },
          deviceId: { type: 'string', description: 'Device identifier' },
          name: { type: 'string', description: 'Display name for pairing' },
          transport: { type: 'string', enum: ['ssh', 'adb', 'local'], description: 'Transport type for pairing' },
          address: { type: 'string', description: 'Connection address (host/IP)' },
          port: { type: 'number', description: 'Connection port' },
          username: { type: 'string', description: 'SSH username' },
          keyPath: { type: 'string', description: 'Path to SSH key' },
          command: { type: 'string', description: 'Command to run (for run action)' },
          duration: { type: 'number', description: 'Recording duration in seconds (for record action)' },
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
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['device', 'ssh', 'adb', 'android', 'remote', 'screenshot', 'camera', 'screen', 'record'],
      priority: 4,
      requiresConfirmation: true,
      modifiesFiles: false,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// DeployExecuteTool
// ============================================================================

const DEPLOY_ACTIONS = ['generate_config', 'deploy', 'status', 'logs'] as const;
const DEPLOY_PLATFORMS = ['fly', 'railway', 'render', 'hetzner', 'northflank', 'gcp'] as const;

/**
 * DeployExecuteTool - ITool adapter for cloud deployment
 */
export class DeployExecuteTool implements ITool {
  readonly name = 'deploy';
  readonly description = 'Deploy applications to cloud platforms (Fly.io, Railway, Render, GCP, Hetzner, Northflank). Generate configs, deploy, check status, view logs.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const tool = await getDeployInstance();
    return await tool.execute({
      action: input.action as 'generate_config' | 'deploy' | 'status' | 'logs',
      platform: input.platform as 'fly' | 'railway' | 'render' | 'hetzner' | 'northflank' | 'gcp',
      appName: input.appName as string | undefined,
      region: input.region as string | undefined,
      port: input.port as number | undefined,
      env: input.env as Record<string, string> | undefined,
      memory: input.memory as string | undefined,
      cpus: input.cpus as number | undefined,
      outputDir: input.outputDir as string | undefined,
      tailLines: input.tailLines as number | undefined,
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
            enum: [...DEPLOY_ACTIONS],
            description: 'Deployment action: generate_config, deploy, status, or logs',
          },
          platform: {
            type: 'string',
            enum: [...DEPLOY_PLATFORMS],
            description: 'Target cloud platform',
          },
          appName: {
            type: 'string',
            description: 'Application name (used in config generation)',
          },
          region: {
            type: 'string',
            description: 'Deployment region (e.g. iad, us-central1)',
          },
          port: {
            type: 'number',
            description: 'Application port (default: 3000)',
          },
          env: {
            type: 'object',
            description: 'Environment variables as key-value pairs',
          },
          memory: {
            type: 'string',
            description: 'Memory allocation (e.g. 512mb, 1gb)',
          },
          cpus: {
            type: 'number',
            description: 'Number of CPU cores',
          },
          outputDir: {
            type: 'string',
            description: 'Directory to write generated config files (for generate_config action)',
          },
          tailLines: {
            type: 'number',
            description: 'Number of log lines to retrieve (default: 50, for logs action)',
          },
        },
        required: ['action', 'platform'],
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

    if (!(DEPLOY_ACTIONS as readonly string[]).includes(data.action)) {
      return { valid: false, errors: [`Unknown action: ${data.action}. Must be one of: ${DEPLOY_ACTIONS.join(', ')}`] };
    }

    if (typeof data.platform !== 'string' || data.platform.trim() === '') {
      return { valid: false, errors: ['platform must be a non-empty string'] };
    }

    if (!(DEPLOY_PLATFORMS as readonly string[]).includes(data.platform)) {
      return { valid: false, errors: [`Unknown platform: ${data.platform}. Must be one of: ${DEPLOY_PLATFORMS.join(', ')}`] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['deploy', 'cloud', 'fly', 'railway', 'render', 'gcp', 'hosting', 'production'],
      priority: 6,
      requiresConfirmation: true,
      modifiesFiles: true,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

// ============================================================================
// KnowledgeGraphQueryTool
// ============================================================================

const KG_ACTIONS = ['query', 'add', 'subgraph', 'path', 'stats'] as const;

/**
 * KnowledgeGraphQueryTool - ITool adapter for the in-memory code knowledge graph
 */
export class KnowledgeGraphQueryTool implements ITool {
  readonly name = 'knowledge_graph';
  readonly description = 'Query the code knowledge graph for entity relationships (imports, calls, extends, exports). Add triples or query patterns.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const { KnowledgeGraph } = await import('../../knowledge/knowledge-graph.js');
    const graph = KnowledgeGraph.getInstance();
    const action = input.action as string;

    switch (action) {
      case 'query': {
        const pattern: Record<string, string | undefined> = {};
        if (input.subject) pattern.subject = input.subject as string;
        if (input.predicate) pattern.predicate = input.predicate as string;
        if (input.object) pattern.object = input.object as string;
        const results = graph.query(pattern);
        if (results.length === 0) {
          return { success: true, output: 'No matching triples found.' };
        }
        const lines = results.map(t => `${t.subject} --${t.predicate}--> ${t.object}`);
        return { success: true, output: `Found ${results.length} triple(s):\n${lines.join('\n')}` };
      }

      case 'add': {
        const subject = input.subject as string;
        const predicate = input.predicate as string;
        const object = input.object as string;
        if (!subject || !predicate || !object) {
          return { success: false, error: 'add requires subject, predicate, and object' };
        }
        const metadata = input.metadata as Record<string, string> | undefined;
        graph.add(subject, predicate, object, metadata);
        return { success: true, output: `Added: ${subject} --${predicate}--> ${object}` };
      }

      case 'subgraph': {
        const entity = input.entity as string;
        if (!entity) {
          return { success: false, error: 'subgraph requires entity' };
        }
        const depth = (input.depth as number) ?? 2;
        const sg = graph.subgraph(entity, depth);
        if (sg.triples.length === 0) {
          return { success: true, output: `No relationships found for "${entity}".` };
        }
        const lines = sg.triples.map(t => `${t.subject} --${t.predicate}--> ${t.object}`);
        return {
          success: true,
          output: `Subgraph for "${entity}" (depth ${depth}, ${sg.entities.size} entities, ${sg.triples.length} triples):\n${lines.join('\n')}`,
        };
      }

      case 'path': {
        const from = input.from as string;
        const to = input.to as string;
        if (!from || !to) {
          return { success: false, error: 'path requires from and to' };
        }
        const maxDepth = (input.maxDepth as number) ?? 5;
        const paths = graph.findPath(from, to, maxDepth);
        if (paths.length === 0) {
          return { success: true, output: `No path found from "${from}" to "${to}".` };
        }
        const formatted = paths.map((p, i) => {
          const steps = p.map(t => `${t.subject} --${t.predicate}--> ${t.object}`);
          return `Path ${i + 1} (${p.length} hops):\n  ${steps.join('\n  ')}`;
        });
        return { success: true, output: `Found ${paths.length} path(s):\n${formatted.join('\n')}` };
      }

      case 'stats': {
        const stats = graph.getStats();
        return {
          success: true,
          output: `Knowledge Graph Stats:\n  Triples: ${stats.tripleCount}\n  Subjects: ${stats.subjectCount}\n  Predicates: ${stats.predicateCount}\n  Objects: ${stats.objectCount}`,
        };
      }

      default:
        return { success: false, error: `Unknown action: ${action}. Valid actions: ${KG_ACTIONS.join(', ')}` };
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
            enum: [...KG_ACTIONS],
            description: 'Action to perform on the knowledge graph',
          },
          subject: {
            type: 'string',
            description: 'Triple subject (entity name, e.g. "src/index.ts", "MyClass"). Used by query and add.',
          },
          predicate: {
            type: 'string',
            description: 'Triple predicate (relationship type: imports, exports, calls, extends, implements, dependsOn, contains, definedIn, usedBy, typeof). Used by query and add.',
          },
          object: {
            type: 'string',
            description: 'Triple object (target entity). Used by query and add.',
          },
          metadata: {
            type: 'object',
            description: 'Optional metadata key-value pairs for add action.',
          },
          entity: {
            type: 'string',
            description: 'Entity name for subgraph exploration.',
          },
          depth: {
            type: 'number',
            description: 'Max traversal depth for subgraph (default: 2).',
          },
          from: {
            type: 'string',
            description: 'Starting entity for path finding.',
          },
          to: {
            type: 'string',
            description: 'Target entity for path finding.',
          },
          maxDepth: {
            type: 'number',
            description: 'Max path length for path finding (default: 5).',
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

    if (typeof data.action !== 'string' || data.action.trim() === '') {
      return { valid: false, errors: ['action must be a non-empty string'] };
    }

    if (!(KG_ACTIONS as readonly string[]).includes(data.action)) {
      return { valid: false, errors: [`Unknown action: ${data.action}. Valid: ${KG_ACTIONS.join(', ')}`] };
    }

    if (data.action === 'add') {
      if (!data.subject || !data.predicate || !data.object) {
        return { valid: false, errors: ['add action requires subject, predicate, and object'] };
      }
    }

    if (data.action === 'subgraph' && !data.entity) {
      return { valid: false, errors: ['subgraph action requires entity'] };
    }

    if (data.action === 'path' && (!data.from || !data.to)) {
      return { valid: false, errors: ['path action requires from and to'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'utility' as ToolCategoryType,
      keywords: ['knowledge', 'graph', 'relationships', 'imports', 'calls', 'extends', 'dependencies', 'code', 'architecture'],
      priority: 6,
      requiresConfirmation: false,
      modifiesFiles: false,
      makesNetworkRequests: false,
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
    new SkillDiscoveryExecuteTool(),
    new DeviceExecuteTool(),
    new DeployExecuteTool(),
    new KnowledgeGraphQueryTool(),
  ];
}
