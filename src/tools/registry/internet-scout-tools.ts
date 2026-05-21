import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import {
  INTERNET_SCOUT_INTENTS,
  buildInternetScoutPlan,
  renderInternetScoutPlan,
  type InternetScoutIntent,
  type InternetScoutPlanOptions,
} from '../../browser-automation/internet-scout-plan.js';
import {
  renderInternetScoutRunResult,
  runInternetScout,
  type InternetScoutExecutableTool,
  type InternetScoutRunOptions,
  type InternetScoutToolExecutor,
} from '../../browser-automation/internet-scout-runner.js';
import { WebFetchTool, WebSearchExecuteTool } from './web-tools.js';
import { BrowserExecuteTool } from './misc-tools.js';
import { RelationshipContextTool } from './relationship-intelligence-tools.js';
import { RememberTool } from './memory-tools.js';
import { LessonsAddTool } from './lessons-tools.js';

const INTENTS: InternetScoutIntent[] = [...INTERNET_SCOUT_INTENTS];

export class InternetScoutPlanTool implements ITool {
  readonly name = 'internet_scout_plan';
  readonly description =
    'Build a safe, evidence-first web navigation plan inspired by advanced browsing workflows: search, static fetch, browser observe/extract/assert, stop conditions, and optional persistence.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const plan = buildInternetScoutPlan(input as unknown as InternetScoutPlanOptions);
      return {
        success: true,
        output: [
          renderInternetScoutPlan(plan),
          '',
          'Structured result:',
          JSON.stringify(plan, null, 2),
        ].join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: 'What the agent needs to learn, verify, or collect from the public/user-authorized web.',
          },
          query: {
            type: 'string',
            description: 'Optional search query. Defaults to goal.',
          },
          sourceUrl: {
            type: 'string',
            description: 'Known starting URL. If omitted, the plan starts with web_search.',
          },
          intent: {
            type: 'string',
            enum: INTENTS,
            description: 'Navigation intent. Prospecting/profile intents add relationship_context.',
          },
          requiresInteraction: {
            type: 'boolean',
            description: 'Whether the page likely needs clicks, forms, tabs, or scrolling before extraction.',
          },
          expectedText: {
            type: 'string',
            description: 'Text that should be asserted with browser.assert_text after navigation.',
          },
          persistWhenProven: {
            type: 'boolean',
            description: 'Add remember/lessons_add steps after evidence or assertions prove durable facts.',
          },
          maxPages: {
            type: 'number',
            minimum: 1,
            maximum: 20,
            description: 'Public page budget for discovery and source review. Defaults to 5.',
          },
          allowLoginPages: {
            type: 'boolean',
            description: 'Whether user-authorized login pages may be opened. Does not permit credential or captcha bypass.',
          },
        },
        required: ['goal'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }

    const data = input as Record<string, unknown>;
    if (typeof data.goal !== 'string' || data.goal.trim() === '') {
      return { valid: false, errors: ['goal must be a non-empty string'] };
    }

    if (data.intent !== undefined && !INTENTS.includes(data.intent as InternetScoutIntent)) {
      return { valid: false, errors: [`intent must be one of: ${INTENTS.join(', ')}`] };
    }

    if (data.maxPages !== undefined) {
      if (typeof data.maxPages !== 'number' || !Number.isFinite(data.maxPages)) {
        return { valid: false, errors: ['maxPages must be a finite number'] };
      }
      if (data.maxPages < 1 || data.maxPages > 20) {
        return { valid: false, errors: ['maxPages must be between 1 and 20'] };
      }
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: [
        'internet scout',
        'surf',
        'browse',
        'navigation',
        'osint',
        'prospecting',
        'web research',
        'search',
        'fetch',
        'observe',
        'extract',
        'assert',
        'stagehand',
        'evidence',
        'rate limit',
      ],
      priority: 8,
      requiresConfirmation: false,
      modifiesFiles: false,
      makesNetworkRequests: false,
      fleetSafe: true,
      dependencies: ['web_search', 'web_fetch', 'browser', 'relationship_context'],
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export class InternetScoutRunTool implements ITool {
  readonly name = 'internet_scout_run';
  readonly description =
    'Execute a bounded Internet Scout workflow with web search/fetch and Playwright-backed browser observe/extract/assert steps, stopping on captcha, login walls, paywalls, 403/429, or access-control bypass signals.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const result = await runInternetScout(
        input as unknown as InternetScoutRunOptions,
        createDefaultInternetScoutExecutor(),
      );
      return {
        success: result.success,
        output: [
          renderInternetScoutRunResult(result),
          '',
          'Structured result:',
          JSON.stringify(result, null, 2),
        ].join('\n'),
        data: result,
        ...(result.success ? {} : { error: result.blocker || 'Internet Scout run did not complete successfully' }),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: 'What the agent should learn, verify, or collect from public/user-authorized sources.',
          },
          query: {
            type: 'string',
            description: 'Optional search query. Defaults to goal.',
          },
          sourceUrl: {
            type: 'string',
            description: 'Known starting URL. If omitted, the run starts with web_search and selects public candidates.',
          },
          intent: {
            type: 'string',
            enum: INTENTS,
            description: 'Navigation intent. Prospecting/profile intents run relationship_context after extraction.',
          },
          requiresInteraction: {
            type: 'boolean',
            description: 'Whether the page likely needs observation before extraction. The runner does not invent clicks.',
          },
          expectedText: {
            type: 'string',
            description: 'Text that must be proven with browser.assert_text for success.',
          },
          persistWhenProven: {
            type: 'boolean',
            description: 'Ask browser extract/assert to return persistence suggestions after proof.',
          },
          executePersistence: {
            type: 'boolean',
            description: 'Actually execute remember/lessons_add suggestions. Default false.',
          },
          maxPages: {
            type: 'number',
            minimum: 1,
            maximum: 20,
            description: 'Maximum public source candidates. Defaults to 5.',
          },
          useBrowser: {
            type: 'boolean',
            description: 'Use Playwright/browser for navigate, observe, extract, and assert. Default true.',
          },
          headless: {
            type: 'boolean',
            description: 'Run browser headless. Default true.',
          },
          browserPageLimit: {
            type: 'number',
            minimum: 0,
            maximum: 5,
            description: 'Maximum candidate pages to open in the browser. Defaults to 1.',
          },
          scrollCount: {
            type: 'number',
            minimum: 0,
            maximum: 5,
            description: 'Optional number of down-scrolls before browser.extract. Defaults to 0.',
          },
          waitUntil: {
            type: 'string',
            enum: ['load', 'domcontentloaded', 'networkidle'],
            description: 'Navigation completion condition. Defaults to domcontentloaded.',
          },
          allowLoginPages: {
            type: 'boolean',
            description: 'Allow user-authorized login pages to open, without credential/captcha bypass.',
          },
        },
        required: ['goal'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    const baseValidation = validateScoutInput(input);
    if (!baseValidation.valid) {
      return baseValidation;
    }

    const data = input as Record<string, unknown>;
    const numericChecks: Array<[string, number, number]> = [
      ['browserPageLimit', 0, 5],
      ['scrollCount', 0, 5],
    ];
    for (const [field, min, max] of numericChecks) {
      const value = data[field];
      if (value === undefined) {
        continue;
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { valid: false, errors: [`${field} must be a finite number`] };
      }
      if (value < min || value > max) {
        return { valid: false, errors: [`${field} must be between ${min} and ${max}`] };
      }
    }

    if (data.waitUntil !== undefined && !['load', 'domcontentloaded', 'networkidle'].includes(data.waitUntil as string)) {
      return { valid: false, errors: ['waitUntil must be one of: load, domcontentloaded, networkidle'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: [
        'internet scout',
        'run',
        'surf',
        'browse',
        'playwright',
        'browser',
        'osint',
        'prospecting',
        'search',
        'fetch',
        'observe',
        'extract',
        'assert',
        'evidence',
      ],
      priority: 9,
      requiresConfirmation: true,
      modifiesFiles: false,
      makesNetworkRequests: true,
      fleetSafe: false,
      dependencies: ['web_search', 'web_fetch', 'browser', 'relationship_context'],
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createInternetScoutTools(): ITool[] {
  return [new InternetScoutPlanTool(), new InternetScoutRunTool()];
}

function validateScoutInput(input: unknown): IValidationResult {
  if (typeof input !== 'object' || input === null) {
    return { valid: false, errors: ['Input must be an object'] };
  }

  const data = input as Record<string, unknown>;
  if (typeof data.goal !== 'string' || data.goal.trim() === '') {
    return { valid: false, errors: ['goal must be a non-empty string'] };
  }

  if (data.intent !== undefined && !INTENTS.includes(data.intent as InternetScoutIntent)) {
    return { valid: false, errors: [`intent must be one of: ${INTENTS.join(', ')}`] };
  }

  if (data.maxPages !== undefined) {
    if (typeof data.maxPages !== 'number' || !Number.isFinite(data.maxPages)) {
      return { valid: false, errors: ['maxPages must be a finite number'] };
    }
    if (data.maxPages < 1 || data.maxPages > 20) {
      return { valid: false, errors: ['maxPages must be between 1 and 20'] };
    }
  }

  return { valid: true };
}

function createDefaultInternetScoutExecutor(): InternetScoutToolExecutor {
  const tools: Record<InternetScoutExecutableTool, ITool> = {
    web_search: new WebSearchExecuteTool(),
    web_fetch: new WebFetchTool(),
    browser: new BrowserExecuteTool(),
    relationship_context: new RelationshipContextTool(),
    remember: new RememberTool(),
    lessons_add: new LessonsAddTool(),
  };

  return {
    async execute(toolName, input) {
      const tool = tools[toolName];
      const validation = tool.validate?.(input);
      if (validation && !validation.valid) {
        return {
          success: false,
          error: `Validation failed: ${validation.errors?.join(', ') || 'Unknown error'}`,
        };
      }
      return tool.execute(input);
    },
  };
}
