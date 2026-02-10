/**
 * Miscellaneous Tool Adapters
 *
 * ITool-compliant adapters for BrowserTool and ReasoningTool operations.
 * These adapters wrap the existing tools to conform to the formal ITool
 * interface for use with the FormalToolRegistry.
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { BrowserTool, ReasoningTool } from '../index.js';
import type { BrowserParams } from '../browser-tool.js';

// ============================================================================
// Shared Tool Instances
// ============================================================================

let browserInstance: BrowserTool | null = null;
let reasoningInstance: ReasoningTool | null = null;

function getBrowser(): BrowserTool {
  if (!browserInstance) {
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

/**
 * Reset the shared instances (for testing)
 */
export function resetMiscInstances(): void {
  browserInstance = null;
  reasoningInstance = null;
}

// ============================================================================
// BrowserExecuteTool
// ============================================================================

/**
 * BrowserExecuteTool - ITool adapter for browser automation
 */
export class BrowserExecuteTool implements ITool {
  readonly name = 'browser';
  readonly description = 'Automate web browser interactions including navigation, clicking, form filling, and screenshots';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const params: BrowserParams = {
      action: input.action as BrowserParams['action'],
      url: input.url as string | undefined,
      selector: input.selector as string | undefined,
      value: input.value as string | undefined,
      script: input.script as string | undefined,
      timeout: input.timeout as number | undefined,
      screenshotOptions: input.screenshotOptions as BrowserParams['screenshotOptions'],
      scrollOptions: input.scrollOptions as BrowserParams['scrollOptions'],
    };

    return await getBrowser().execute(params);
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
            enum: [
              'navigate',
              'click',
              'fill',
              'screenshot',
              'getText',
              'getHtml',
              'evaluate',
              'waitForSelector',
              'getLinks',
              'getForms',
              'submit',
              'select',
              'hover',
              'scroll',
              'goBack',
              'goForward',
              'reload',
              'close',
            ],
          },
          url: {
            type: 'string',
            description: 'URL to navigate to (for navigate action)',
          },
          selector: {
            type: 'string',
            description: 'CSS selector for element operations',
          },
          value: {
            type: 'string',
            description: 'Value for fill/select operations',
          },
          script: {
            type: 'string',
            description: 'JavaScript code for evaluate action',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds',
          },
          screenshotOptions: {
            type: 'object',
            description: 'Options for screenshot action',
          },
          scrollOptions: {
            type: 'object',
            description: 'Options for scroll action',
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

    const validActions = [
      'navigate',
      'click',
      'fill',
      'screenshot',
      'getText',
      'getHtml',
      'evaluate',
      'waitForSelector',
      'getLinks',
      'getForms',
      'submit',
      'select',
      'hover',
      'scroll',
      'goBack',
      'goForward',
      'reload',
      'close',
    ];

    if (!validActions.includes(data.action)) {
      return { valid: false, errors: [`Unknown action: ${data.action}`] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['browser', 'web', 'automation', 'playwright', 'screenshot', 'scrape'],
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
      await browserInstance.close();
      browserInstance = null;
    }
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
    new ReasoningExecuteTool(),
  ];
}
