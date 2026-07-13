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
  buildBrowserOperatorSessionDraft,
  renderBrowserOperatorSessionDraft,
  type BrowserOperatorMode,
} from '../../browser-automation/browser-operator-session.js';

const MODES: BrowserOperatorMode[] = ['isolated', 'local'];
const INTENTS: InternetScoutIntent[] = [...INTERNET_SCOUT_INTENTS];

/**
 * `browser_operator` — propose a consent-gated Browser Operator session.
 *
 * This tool lets the agent *initiate* a live-web session for goals that
 * `web_search` / `web_fetch` cannot satisfy (interaction, login walls,
 * multi-step navigation). It does **not** launch a browser: it builds a
 * reviewable {@link BrowserOperatorSessionDraft} (action log, consent scopes,
 * stop control, proof export) from the goal, purely (no network). The operator
 * reviews and runs it; `local` / interactive / login-gated plans surface
 * `consent.required = true`, so execution stays human-gated by design.
 *
 * In Cowork the call is consumed live: the tool name matches
 * `isBrowserOperatorTool()` (it starts with `browser_`), so the engine runner
 * emits a `browser.action` event and the BrowserOperatorOverlay renders the
 * proposed session as it happens (see cowork/src/main/engine/browser-action.ts
 * and codebuddy-engine-runner.ts).
 */
export class BrowserOperatorTool implements ITool {
  readonly name = 'browser_operator';
  readonly description =
    'Propose a consent-gated Browser Operator session for a live web goal that web_search/web_fetch cannot satisfy (interaction, login-gated, multi-step). Returns a reviewable plan — action log, consent scopes, stop control, proof export — WITHOUT launching a browser. Resolve and pass sourceUrl for an executable runtime; a draft without sourceUrl remains review-only. The operator reviews and runs it; local/interactive/login-gated sessions require explicit consent.';

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const data = (input ?? {}) as Record<string, unknown>;
      const planOptions: InternetScoutPlanOptions = {
        goal: typeof data.goal === 'string' ? data.goal : String(data.goal ?? ''),
        ...(typeof data.query === 'string' ? { query: data.query } : {}),
        ...(typeof data.sourceUrl === 'string' ? { sourceUrl: data.sourceUrl } : {}),
        ...(typeof data.intent === 'string' ? { intent: data.intent as InternetScoutIntent } : {}),
        ...(typeof data.requiresInteraction === 'boolean'
          ? { requiresInteraction: data.requiresInteraction }
          : {}),
        ...(typeof data.interactionInstruction === 'string'
          ? { interactionInstruction: data.interactionInstruction }
          : {}),
        ...(typeof data.expectedText === 'string' ? { expectedText: data.expectedText } : {}),
        ...(typeof data.maxPages === 'number' ? { maxPages: data.maxPages } : {}),
        ...(typeof data.allowLoginPages === 'boolean' ? { allowLoginPages: data.allowLoginPages } : {}),
      };

      const plan = buildInternetScoutPlan(planOptions);
      const mode: BrowserOperatorMode = data.mode === 'local' ? 'local' : 'isolated';
      const draft = buildBrowserOperatorSessionDraft(plan, { mode });

      const consentLine = draft.consent.required
        ? `⚠ Consent required (scopes: ${draft.consent.scopes.join(', ')}). This proposal does NOT launch a browser — the operator must review and grant consent before any session runs.`
        : 'Isolated public-read plan: no local/authenticated browser access requested. This proposal does NOT launch a browser; the operator reviews and runs it.';
      const executionLine = draft.sourceUrl
        ? `Executable starting URL: ${draft.sourceUrl}`
        : 'Review-only draft: resolve a public HTTP(S) sourceUrl, then create a new Browser Operator draft before execution.';

      return {
        success: true,
        output: [
          renderBrowserOperatorSessionDraft(draft),
          '',
          consentLine,
          executionLine,
          '',
          '## Source Plan',
          renderInternetScoutPlan(plan),
          '',
          'Structured result:',
          JSON.stringify({ draft, plan }, null, 2),
        ].join('\n'),
        data: { draft, plan },
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
            description: 'What the browser session should accomplish, e.g. "log into the dashboard and export the monthly report".',
          },
          query: {
            type: 'string',
            description: 'Optional search query seed. Defaults to the goal.',
          },
          sourceUrl: {
            type: 'string',
            description: 'Explicit credential-free HTTP(S) starting URL. Required by the executable runtime; resolve it with web_search first when unknown.',
          },
          intent: {
            type: 'string',
            enum: INTENTS,
            description: 'Plan intent. Defaults to research.',
          },
          mode: {
            type: 'string',
            enum: MODES,
            description: 'Browser surface. "isolated" (default) is headless; "local" opens a fresh visible dedicated browser owned by Code Buddy. Attaching an existing logged-in browser is not yet supported.',
          },
          requiresInteraction: {
            type: 'boolean',
            description: 'Set true when the goal needs clicking/typing (mutating interaction). Adds an interact stage and consent scope.',
          },
          interactionInstruction: {
            type: 'string',
            description: 'Exact single visible browser action to review and confirm. Defaults to goal when requiresInteraction is true.',
          },
          allowLoginPages: {
            type: 'boolean',
            description: 'Set true when the session may pass authenticated/login pages. Requires consent (authenticated_tabs scope).',
          },
          expectedText: {
            type: 'string',
            description: 'Optional text whose presence proves the goal was reached (verification evidence).',
          },
          maxPages: {
            type: 'number',
            minimum: 1,
            maximum: 50,
            description: 'Maximum pages the session may visit. Defaults to 5.',
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

    if (data.mode !== undefined && !MODES.includes(data.mode as BrowserOperatorMode)) {
      return { valid: false, errors: [`mode must be one of: ${MODES.join(', ')}`] };
    }

    if (data.maxPages !== undefined) {
      if (typeof data.maxPages !== 'number' || !Number.isFinite(data.maxPages)) {
        return { valid: false, errors: ['maxPages must be a finite number'] };
      }
      if (data.maxPages < 1 || data.maxPages > 50) {
        return { valid: false, errors: ['maxPages must be between 1 and 50'] };
      }
    }

    for (const flag of ['requiresInteraction', 'allowLoginPages'] as const) {
      if (data[flag] !== undefined && typeof data[flag] !== 'boolean') {
        return { valid: false, errors: [`${flag} must be a boolean`] };
      }
    }

    if (data.interactionInstruction !== undefined && (
      typeof data.interactionInstruction !== 'string' || data.interactionInstruction.trim() === ''
    )) {
      return { valid: false, errors: ['interactionInstruction must be a non-empty string'] };
    }

    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: [
        'browser operator',
        'browser',
        'web automation',
        'live web',
        'navigate',
        'login',
        'interaction',
        'consent',
        'stagehand',
        'computer use',
        'session',
        'stop control',
        'proof export',
        'operator',
      ],
      priority: 6,
      requiresConfirmation: false,
      modifiesFiles: false,
      makesNetworkRequests: false,
      fleetSafe: false,
      dependencies: ['internet_scout_plan', 'browser', 'web_search', 'web_fetch'],
    };
  }

  isAvailable(): boolean {
    return true;
  }
}

export function createBrowserOperatorTools(): ITool[] {
  return [new BrowserOperatorTool()];
}
