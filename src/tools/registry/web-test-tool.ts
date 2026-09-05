/**
 * web_test — one-call structured UI test with EVIDENCE, for the
 * develop → launch → browse → verify loop.
 *
 * Orchestrates the shared browser session: navigate (through the same
 * navigation gate as every browser action — dev origins or safe URLs only),
 * collect console messages AND page errors (the client face of a bug),
 * pull the server-side log tail when the URL belongs to an app_server-managed
 * process (the server face), take an accessibility snapshot and a screenshot,
 * run declarative assertions, and return a single pass/fail report where
 * every check shows its evidence — the agent renders proof, not claims
 * (Replit's "no Potemkin interfaces" rule).
 */

import type { ToolResult } from '../../types/index.js';
import type { ITool, ToolSchema, IToolMetadata, IValidationResult, ToolCategoryType } from './types.js';
import { BrowserConsoleExecuteTool, BrowserExecuteTool, BrowserSnapshotExecuteTool } from './misc-tools.js';

export interface WebTestAssertion {
  /** 'text' = page text contains value; 'selector' = querySelector matches; 'title' = document.title contains value. */
  type: 'text' | 'selector' | 'title';
  value: string;
}

/**
 * A single interaction played AFTER navigation and BEFORE the oracles /
 * assertions — this is what lets web_test test a FLOW (fill a field, click a
 * button, verify the result) instead of just "the page loads and shows X".
 * A page can render fine while its "Send" button does nothing (the Potemkin
 * interface); a step that clicks it and a network/console oracle running
 * afterward catch exactly that.
 */
export interface WebTestStep {
  /** click a CSS selector, type a value into an input/textarea, submit a form, or just wait. */
  action: 'click' | 'type' | 'wait' | 'submit';
  /** CSS selector for click/type/submit. */
  selector?: string;
  /** Value to set for `type`. */
  value?: string;
  /** Milliseconds for `wait` (bounded to 5000). */
  ms?: number;
}

/** Upper bound for a single `wait` step, so a test can't stall the loop. */
const MAX_WAIT_MS = 5000;

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

interface ConsoleEntry {
  type: string;
  text: string;
}

interface NetworkFailureEntry {
  kind: 'requestfailed' | 'httperror';
  url: string;
  method: string;
  status?: number;
  errorText?: string;
}

export class WebTestTool implements ITool {
  readonly name = 'web_test';
  readonly description =
    'Test a web page in one call: navigate, collect console errors + page errors + server logs (for app_server-managed URLs), snapshot, screenshot, run assertions, and return a structured pass/fail report with evidence. Use after building or changing a web UI.';

  private browser = new BrowserExecuteTool();
  private consoleTool = new BrowserConsoleExecuteTool();
  private snapshotTool = new BrowserSnapshotExecuteTool();

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const url = input.url as string;
    const assertions = (input.assertions as WebTestAssertion[] | undefined) ?? [];
    const steps = (input.steps as WebTestStep[] | undefined) ?? [];
    const wantScreenshot = input.screenshot !== false;
    const allowConsoleErrors = input.allowConsoleErrors === true;
    const allowNetworkErrors = input.allowNetworkErrors === true;

    const checks: CheckResult[] = [];
    const push = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });

    // 1. Launch (idempotent) + fresh console buffer, then navigate through
    //    the standard gate.
    const launched = await this.browser.execute({ action: 'launch', headless: true });
    if (!launched.success) {
      return { success: false, error: `Browser launch failed: ${launched.error}` };
    }
    await this.consoleTool.execute({ action: 'clear' }).catch(() => {});
    await this.browser.execute({ action: 'network', networkAction: 'clear' }).catch(() => {});

    const navigated = await this.browser.execute({ action: 'navigate', url, waitUntil: 'load' });
    push('navigation', navigated.success, navigated.success ? `loaded ${url}` : navigated.error ?? 'failed');
    if (!navigated.success) {
      return this.report(url, checks, { consoleEntries: [], networkFailures: [], serverLogs: await this.serverLogsFor(url) });
    }

    // 1b. Interaction steps — played in order, AFTER navigation and BEFORE the
    //     oracles/assertions. Each becomes a check with evidence; a failing
    //     step (e.g. missing selector) stops the sequence and fails the run.
    //     Whatever a step triggers (a fetch, a console error) is then caught by
    //     the oracles below — that's the whole point of running them after.
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const result = await this.runStep(step);
      push(this.describeStep(step, i + 1), result.passed, result.detail);
      if (!result.passed) break;
    }

    // Give late console errors (async boot code) and any step-triggered async
    // work (a fetch fired by a click) a beat to land before the oracles read.
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 2. Client-side oracle: console + pageerror.
    const consoleEntries = await this.readConsole();
    const errors = consoleEntries.filter((entry) => entry.type === 'error' || entry.type === 'pageerror');
    push(
      'console',
      allowConsoleErrors || errors.length === 0,
      errors.length === 0 ? 'no console/page errors' : `${errors.length} error(s): ${errors.map((e) => e.text).slice(0, 5).join(' | ')}`,
    );

    // 2b. Network oracle: failed requests + >= 400 responses. A page can render
    //     fine while its API calls silently fail — a major bug oracle.
    const networkFailures = await this.readNetwork();
    push(
      'network',
      allowNetworkErrors || networkFailures.length === 0,
      networkFailures.length === 0
        ? 'no failed requests'
        : `${networkFailures.length} request(s) failed: ${networkFailures.map((f) => this.describeFailure(f)).slice(0, 5).join(' | ')}`,
    );

    // 3. Declarative assertions, each with its own evidence line.
    for (const assertion of assertions) {
      const result = await this.runAssertion(assertion);
      push(`assert ${assertion.type} "${assertion.value}"`, result.passed, result.detail);
    }

    // 4. Structure snapshot (numbered refs — the agent can interact next).
    const snapshot = await this.snapshotTool.execute({ interactiveOnly: true, maxElements: 15 });
    const snapshotSummary = snapshot.success ? (snapshot.output ?? '').split('\n').slice(0, 18).join('\n') : `snapshot failed: ${snapshot.error}`;

    // 5. Screenshot as reviewable evidence. A missing capture is a failed
    //    check — never announce PASSED without the file the report claims.
    let screenshotPath: string | undefined;
    if (wantScreenshot) {
      const shot = await this.browser.execute({ action: 'screenshot' });
      if (shot.success) {
        screenshotPath =
          ((shot.data as { path?: string } | undefined)?.path) ??
          shot.output?.match(/saved to (\S+)/)?.[1] ??
          shot.output?.match(/Screenshot saved:\s+(\S+)/)?.[1];
      }
      const detail = screenshotPath
        ? screenshotPath
        : (shot.success ? 'no path returned' : (shot.error ?? 'screenshot failed'));
      push('screenshot', Boolean(screenshotPath), detail);
    }

    // 6. Server face of the bug, when we manage this origin.
    const serverLogs = await this.serverLogsFor(url);

    return this.report(url, checks, { consoleEntries, networkFailures, serverLogs, snapshotSummary, screenshotPath });
  }

  private async readConsole(): Promise<ConsoleEntry[]> {
    const listed = await this.consoleTool.execute({ action: 'list', limit: 50 });
    if (!listed.success) return [];
    const entries = (listed.data as { entries?: ConsoleEntry[] } | undefined)?.entries;
    return entries ?? [];
  }

  private async readNetwork(): Promise<NetworkFailureEntry[]> {
    const listed = await this.browser.execute({ action: 'network', networkAction: 'list', limit: 50 });
    if (!listed.success) return [];
    const failures = (listed.data as { failures?: NetworkFailureEntry[] } | undefined)?.failures;
    return failures ?? [];
  }

  private describeFailure(failure: NetworkFailureEntry): string {
    const method = failure.method || 'GET';
    if (failure.kind === 'httperror') {
      return `${method} ${failure.url} → ${failure.status ?? 'error'}`;
    }
    return `${method} ${failure.url} → ${failure.errorText || 'request failed'}`;
  }

  private async runAssertion(assertion: WebTestAssertion): Promise<{ passed: boolean; detail: string }> {
    const value = JSON.stringify(assertion.value);
    const expression =
      assertion.type === 'text'
        ? `document.body && document.body.innerText.includes(${value})`
        : assertion.type === 'selector'
          ? `!!document.querySelector(${value})`
          : `document.title.includes(${value})`;
    const result = await this.browser.execute({ action: 'evaluate', expression });
    if (!result.success) return { passed: false, detail: `evaluate failed: ${result.error}` };
    const passed = (result.data as { result?: unknown } | undefined)?.result === true;
    return { passed, detail: passed ? 'found' : 'NOT found' };
  }

  /**
   * Play one interaction via a safe `evaluate` expression — the SAME mechanism
   * `runAssertion` uses. Selectors/values are serialized with `JSON.stringify`
   * (never interpolated raw) so a hostile selector can't break out. click/type/
   * submit throw inside the page when the target is missing, so the step fails
   * cleanly; `wait` just sleeps (bounded).
   */
  private async runStep(step: WebTestStep): Promise<{ passed: boolean; detail: string }> {
    if (step.action === 'wait') {
      const ms = Math.max(0, Math.min(Number(step.ms) || 0, MAX_WAIT_MS));
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { passed: true, detail: `waited ${ms}ms` };
    }

    const selector = step.selector;
    if (typeof selector !== 'string' || selector.trim() === '') {
      return { passed: false, detail: 'missing selector' };
    }
    const sel = JSON.stringify(selector);

    let expression: string;
    if (step.action === 'click') {
      expression = `(() => { const el = document.querySelector(${sel}); if (!el) throw new Error("element not found: " + ${sel}); el.click(); return true; })()`;
    } else if (step.action === 'type') {
      const val = JSON.stringify(step.value ?? '');
      // Set .value then dispatch input + change so React/Vue controlled inputs
      // observe the change (a bare .value assignment is invisible to them).
      expression = `(() => { const el = document.querySelector(${sel}); if (!el) throw new Error("element not found: " + ${sel}); el.value = ${val}; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`;
    } else if (step.action === 'submit') {
      // Resolve to the owning form; prefer requestSubmit so onSubmit handlers fire.
      expression = `(() => { const el = document.querySelector(${sel}); if (!el) throw new Error("element not found: " + ${sel}); const form = el.tagName === "FORM" ? el : (el.form || (el.closest && el.closest("form"))); if (!form) throw new Error("no form for selector: " + ${sel}); if (typeof form.requestSubmit === "function") { form.requestSubmit(); } else { form.submit(); } return true; })()`;
    } else {
      return { passed: false, detail: `unknown action: ${String((step as { action?: unknown }).action)}` };
    }

    const result = await this.browser.execute({ action: 'evaluate', expression });
    if (!result.success) {
      const err = result.error ?? 'failed';
      return { passed: false, detail: /not found/i.test(err) ? `NOT found (${selector})` : err };
    }
    return { passed: true, detail: 'ok' };
  }

  private describeStep(step: WebTestStep, n: number): string {
    const sel = step.selector ? `"${step.selector}"` : '';
    switch (step.action) {
      case 'wait':
        return `step ${n} wait ${Math.max(0, Math.min(Number(step.ms) || 0, MAX_WAIT_MS))}ms`;
      case 'type':
        return `step ${n} type ${JSON.stringify(step.value ?? '')} into ${sel}`;
      case 'click':
        return `step ${n} click ${sel}`;
      case 'submit':
        return `step ${n} submit ${sel}`;
      default:
        return `step ${n} ${String((step as { action?: unknown }).action)}`;
    }
  }

  private async serverLogsFor(url: string): Promise<string | undefined> {
    try {
      const origin = new URL(url).origin;
      const { getAppServerTool } = await import('../app-server-tool.js');
      return getAppServerTool().logTailForOrigin(origin) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private report(
    url: string,
    checks: CheckResult[],
    extra: {
      consoleEntries: ConsoleEntry[];
      networkFailures: NetworkFailureEntry[];
      serverLogs?: string;
      snapshotSummary?: string;
      screenshotPath?: string;
    },
  ): ToolResult {
    const passed = checks.every((check) => check.passed);
    const lines: string[] = [
      `Web test ${passed ? 'PASSED' : 'FAILED'} — ${url}`,
      ...checks.map((check) => `${check.passed ? '✓' : '✗'} ${check.name}: ${check.detail}`),
    ];
    if (extra.screenshotPath) lines.push(`Screenshot: ${extra.screenshotPath}`);
    if (extra.snapshotSummary) lines.push('', 'Interactive elements:', extra.snapshotSummary);
    if (extra.networkFailures.length > 0) {
      lines.push('', 'Failed network requests:', ...extra.networkFailures.slice(0, 10).map((f) => `- ${this.describeFailure(f)}`));
    }
    if (extra.serverLogs) lines.push('', 'Server logs (app_server):', extra.serverLogs);
    if (!passed) lines.push('', 'Fix the failures above, then re-run web_test to verify.');

    return {
      // The tool ran; the verdict lives in data.passed and the report. A
      // failing test is a SUCCESSFUL test run — the agent must read it.
      success: true,
      output: lines.join('\n'),
      data: {
        passed,
        url,
        checks,
        consoleErrorCount: extra.consoleEntries.filter((e) => e.type === 'error' || e.type === 'pageerror').length,
        networkFailureCount: extra.networkFailures.length,
        networkFailures: extra.networkFailures,
        screenshotPath: extra.screenshotPath,
      },
    };
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
            description: 'Page to test — a dev origin registered via app_server, or any safe public URL',
          },
          steps: {
            type: 'array',
            description:
              'Optional interactions played in order AFTER navigation and BEFORE the oracles/assertions (order: navigate → steps → console/network/server oracles → assertions). Use them to test a FLOW, not just page load. Each step is a check with evidence; a failing step fails the run. Omit for the original load-and-assert behavior.',
            items: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['click', 'type', 'wait', 'submit'] },
                selector: { type: 'string', description: 'CSS selector for click/type/submit' },
                value: { type: 'string', description: 'Value to type (action=type)' },
                ms: { type: 'number', description: 'Milliseconds to wait (action=wait, max 5000)' },
              },
              required: ['action'],
            },
          },
          assertions: {
            type: 'array',
            description: 'Declarative checks, each rendered with evidence in the report',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['text', 'selector', 'title'] },
                value: { type: 'string' },
              },
              required: ['type', 'value'],
            },
          },
          screenshot: {
            type: 'boolean',
            description: 'Capture a screenshot as evidence (default true)',
          },
          allowConsoleErrors: {
            type: 'boolean',
            description: 'Do not fail the test on console/page errors (default false)',
          },
          allowNetworkErrors: {
            type: 'boolean',
            description: 'Do not fail the test on failed network requests / >= 400 responses (default false)',
          },
        },
        required: ['url'],
      },
    };
  }

  validate(input: unknown): IValidationResult {
    if (typeof input !== 'object' || input === null) {
      return { valid: false, errors: ['Input must be an object'] };
    }
    const data = input as Record<string, unknown>;
    if (typeof data.url !== 'string' || data.url.trim() === '') {
      return { valid: false, errors: ['url is required'] };
    }
    if (data.assertions !== undefined && !Array.isArray(data.assertions)) {
      return { valid: false, errors: ['assertions must be an array'] };
    }
    if (data.steps !== undefined && !Array.isArray(data.steps)) {
      return { valid: false, errors: ['steps must be an array'] };
    }
    return { valid: true };
  }

  getMetadata(): IToolMetadata {
    return {
      name: this.name,
      description: this.description,
      category: 'web' as ToolCategoryType,
      keywords: ['test', 'ui test', 'web test', 'verify', 'check app', 'e2e', 'smoke test', 'console errors'],
      priority: 7,
      requiresConfirmation: true,
      modifiesFiles: false,
      makesNetworkRequests: true,
    };
  }

  isAvailable(): boolean {
    return true;
  }

  dispose(): void {
    // Browser lifecycle belongs to the shared manager.
  }
}
