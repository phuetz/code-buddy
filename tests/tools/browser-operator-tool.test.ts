import { AGENT_TOOLS } from '../../src/codebuddy/tool-definitions/agent-tools.js';
import {
  BrowserOperatorTool,
  createBrowserOperatorTools,
} from '../../src/tools/registry/browser-operator-tools.js';

describe('BrowserOperatorTool (D3)', () => {
  it('exposes a browser_operator schema with goal required and bounded enums', () => {
    const tool = new BrowserOperatorTool();
    const schema = tool.getSchema();

    expect(tool.name).toBe('browser_operator');
    expect(schema.name).toBe('browser_operator');
    expect(schema.parameters.required).toEqual(['goal']);
    expect(schema.parameters.properties?.mode.enum).toEqual(['isolated', 'local']);
    expect(schema.parameters.properties?.intent.enum).toContain('research');
  });

  it('is included in the LLM-facing agent tool definitions', () => {
    expect(AGENT_TOOLS.map((tool) => tool.function.name)).toContain('browser_operator');
  });

  it('registers through the tool factory', () => {
    expect(createBrowserOperatorTools().map((tool) => tool.name)).toEqual(['browser_operator']);
  });

  it('is not fleet-safe (a peer cannot remotely propose a browser session)', () => {
    expect(new BrowserOperatorTool().getMetadata().fleetSafe).toBe(false);
    expect(new BrowserOperatorTool().getMetadata().makesNetworkRequests).toBe(false);
  });

  it('validates required goal and bounded options', () => {
    const tool = new BrowserOperatorTool();
    expect(tool.validate({}).valid).toBe(false);
    expect(tool.validate({ goal: '   ' }).valid).toBe(false);
    expect(tool.validate({ goal: 'do a thing', mode: 'nope' }).valid).toBe(false);
    expect(tool.validate({ goal: 'do a thing', intent: 'nope' }).valid).toBe(false);
    expect(tool.validate({ goal: 'do a thing', maxPages: 0 }).valid).toBe(false);
    expect(tool.validate({ goal: 'do a thing', requiresInteraction: 'yes' }).valid).toBe(false);
    expect(tool.validate({ goal: 'do a thing', mode: 'local', maxPages: 10 }).valid).toBe(true);
  });

  it('builds a consent-gated session draft from a goal (no browser launch)', async () => {
    const tool = new BrowserOperatorTool();
    const result = await tool.execute({ goal: 'find the public opening hours of a museum' });

    expect(result.success).toBe(true);
    const data = result.data as { draft: { sessionId: string; consent: { required: boolean } }; plan: { goal: string } };
    expect(data.draft.sessionId).toBeTruthy();
    expect(data.plan.goal).toContain('museum');
    // The proposal is explicit that it does not launch a browser itself.
    expect(result.output).toContain('does NOT launch a browser');
  });

  it('does NOT require consent for an isolated public-read plan (safe default)', async () => {
    const tool = new BrowserOperatorTool();
    const result = await tool.execute({ goal: 'read a public docs page', mode: 'isolated' });
    const data = result.data as { draft: { consent: { required: boolean; scopes: string[] } } };

    expect(data.draft.consent.required).toBe(false);
    expect(data.draft.consent.scopes).toEqual([]);
  });

  it('REQUIRES consent for a fresh visible local-browser session', async () => {
    const tool = new BrowserOperatorTool();
    const result = await tool.execute({ goal: 'export my dashboard report', mode: 'local' });
    const data = result.data as { draft: { consent: { required: boolean; scopes: string[] } } };

    expect(data.draft.consent.required).toBe(true);
    expect(data.draft.consent.scopes).toContain('local_browser');
  });

  it('REQUIRES consent when the goal needs interaction', async () => {
    const tool = new BrowserOperatorTool();
    const result = await tool.execute({ goal: 'fill and submit a form', requiresInteraction: true });
    const data = result.data as { draft: { consent: { required: boolean; scopes: string[] } } };

    expect(data.draft.consent.required).toBe(true);
    expect(data.draft.consent.scopes).toContain('browser_interaction');
  });

  it('REQUIRES consent when login pages are allowed', async () => {
    const tool = new BrowserOperatorTool();
    const result = await tool.execute({ goal: 'sign in and check messages', allowLoginPages: true });
    const data = result.data as { draft: { consent: { required: boolean; scopes: string[] } } };

    expect(data.draft.consent.required).toBe(true);
    expect(data.draft.consent.scopes).toContain('authenticated_tabs');
  });

  it('never grants consent itself — granted is always false in a proposal', async () => {
    const tool = new BrowserOperatorTool();
    const result = await tool.execute({ goal: 'export my dashboard report', mode: 'local' });
    const data = result.data as { draft: { consent: { granted: boolean } } };

    expect(data.draft.consent.granted).toBe(false);
  });

  it('returns an error (never throws) for an empty goal', async () => {
    const tool = new BrowserOperatorTool();
    const result = await tool.execute({ goal: '' });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
