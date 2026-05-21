import type { ToolResult } from '../../src/types/index.js';
import {
  renderInternetScoutRunResult,
  runInternetScout,
  type InternetScoutExecutableTool,
  type InternetScoutToolExecutor,
} from '../../src/browser-automation/internet-scout-runner.js';

function createExecutor(
  handler: (tool: InternetScoutExecutableTool, input: Record<string, unknown>) => ToolResult,
): InternetScoutToolExecutor & { calls: Array<{ tool: InternetScoutExecutableTool; input: Record<string, unknown> }> } {
  const calls: Array<{ tool: InternetScoutExecutableTool; input: Record<string, unknown> }> = [];
  return {
    calls,
    async execute(tool, input) {
      calls.push({ tool, input });
      return handler(tool, input);
    },
    async isSafeUrl() {
      return { safe: true };
    },
  };
}

describe('runInternetScout', () => {
  it('executes a known URL with Playwright-backed browser steps and relationship context', async () => {
    const executor = createExecutor((tool, input) => {
      if (tool === 'web_fetch') {
        return { success: true, output: 'Content from https://example.com\nExample Domain' };
      }
      if (tool === 'browser' && input.action === 'extract') {
        return {
          success: true,
          output: 'Extracted: Example Domain',
          data: {
            url: 'https://example.com',
            title: 'Example Domain',
            headings: ['Example Domain'],
            matches: ['Example Domain'],
            text: 'Example Domain public page',
          },
        };
      }
      if (tool === 'browser' && input.action === 'assert_text') {
        return {
          success: true,
          output: 'Assertion passed: page contains "Example Domain"',
          data: {
            url: 'https://example.com',
            title: 'Example Domain',
            snippet: 'Example Domain',
          },
        };
      }
      if (tool === 'relationship_context') {
        return { success: true, output: '# Relationship Context: Example Domain' };
      }
      return { success: true, output: `${tool} ok` };
    });

    const result = await runInternetScout({
      goal: 'verifier Example Domain',
      sourceUrl: 'https://example.com',
      intent: 'prospecting',
      expectedText: 'Example Domain',
      requiresInteraction: true,
    }, executor);

    expect(result.success).toBe(true);
    expect(result.stopped).toBe(false);
    expect(result.selectedUrls).toEqual(['https://example.com']);
    expect(result.traces.map((trace) => `${trace.tool}.${trace.action ?? trace.stepId}`)).toContain('browser.navigate');
    expect(result.traces.map((trace) => trace.tool)).toContain('relationship_context');
    expect(result.evidence[0]).toMatchObject({
      url: 'https://example.com',
      title: 'Example Domain',
      assertionPassed: true,
    });
  });

  it('discovers a URL from web_search and can run fetch-only', async () => {
    const executor = createExecutor((tool) => {
      if (tool === 'web_search') {
        return {
          success: true,
          output: '1. **Example** [1]\n**Sources:**\n[1] Example - https://example.com/page',
        };
      }
      if (tool === 'web_fetch') {
        return { success: true, output: 'Content from https://example.com/page\nA useful public source' };
      }
      return { success: false, error: 'unexpected tool' };
    });

    const result = await runInternetScout({
      goal: 'chercher une source publique',
      useBrowser: false,
      maxPages: 2,
    }, executor);

    expect(result.success).toBe(true);
    expect(result.selectedUrls).toEqual(['https://example.com/page']);
    expect(executor.calls.map((call) => call.tool)).toEqual(['web_search', 'web_fetch']);
  });

  it('stops on blocker text from a fetched page', async () => {
    const executor = createExecutor((tool) => {
      if (tool === 'web_fetch') {
        return { success: true, output: 'Please verify you are human. Captcha required.' };
      }
      return { success: true, output: `${tool} ok` };
    });

    const result = await runInternetScout({
      goal: 'inspecter une page',
      sourceUrl: 'https://example.com/protected',
    }, executor);

    expect(result.success).toBe(false);
    expect(result.stopped).toBe(true);
    expect(result.blocker).toBe('captcha or bot challenge');
    expect(result.traces.map((trace) => trace.stepId)).toEqual(['static-read']);
  });

  it('skips persistence suggestions unless explicitly enabled', async () => {
    const executor = createExecutor((tool, input) => {
      if (tool === 'web_fetch') {
        return { success: true, output: 'Content from https://example.com\nDurable fact' };
      }
      if (tool === 'browser' && input.action === 'extract') {
        return {
          success: true,
          output: 'Extracted: Durable fact',
          data: {
            url: 'https://example.com',
            title: 'Durable source',
            headings: ['Durable fact'],
            matches: ['Durable fact'],
            persistenceSuggestions: [
              { tool: 'remember', input: { key: 'web-proof:durable', value: 'Durable fact' } },
            ],
          },
        };
      }
      return { success: true, output: `${tool} ok` };
    });

    const result = await runInternetScout({
      goal: 'verifier une source durable',
      sourceUrl: 'https://example.com',
      persistWhenProven: true,
    }, executor);

    expect(result.success).toBe(true);
    expect(result.traces).toContainEqual(expect.objectContaining({
      stepId: 'persistence-remember',
      tool: 'remember',
      status: 'skipped',
    }));
    expect(executor.calls.map((call) => call.tool)).not.toContain('remember');
  });

  it('executes persistence suggestions when explicitly enabled', async () => {
    const executor = createExecutor((tool, input) => {
      if (tool === 'web_fetch') {
        return { success: true, output: 'Content from https://example.com\nDurable fact' };
      }
      if (tool === 'browser' && input.action === 'extract') {
        return {
          success: true,
          output: 'Extracted: Durable fact',
          data: {
            url: 'https://example.com',
            title: 'Durable source',
            headings: ['Durable fact'],
            persistenceSuggestions: [
              { tool: 'remember', input: { key: 'web-proof:durable', value: 'Durable fact' } },
            ],
          },
        };
      }
      if (tool === 'remember') {
        return { success: true, output: 'remembered' };
      }
      return { success: true, output: `${tool} ok` };
    });

    const result = await runInternetScout({
      goal: 'verifier une source durable',
      sourceUrl: 'https://example.com',
      persistWhenProven: true,
      executePersistence: true,
    }, executor);

    expect(result.success).toBe(true);
    expect(executor.calls.map((call) => call.tool)).toContain('remember');
  });

  it('renders a compact run report', async () => {
    const executor = createExecutor((tool) => {
      if (tool === 'web_fetch') {
        return { success: true, output: 'Content from https://example.com\nExample Domain' };
      }
      if (tool === 'browser') {
        return {
          success: true,
          output: 'Extracted: Example Domain',
          data: { url: 'https://example.com', title: 'Example Domain', headings: ['Example Domain'] },
        };
      }
      return { success: true, output: `${tool} ok` };
    });

    const result = await runInternetScout({
      goal: 'verifier Example Domain',
      sourceUrl: 'https://example.com',
    }, executor);

    const rendered = renderInternetScoutRunResult(result);

    expect(rendered).toContain('## Run Result');
    expect(rendered).toContain('Status: success');
    expect(rendered).toContain('## Trace');
  });
});
